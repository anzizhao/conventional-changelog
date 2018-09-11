'use strict'

const compareFunc = require(`compare-func`)
const Q = require(`q`)
const readFile = Q.denodeify(require(`fs`).readFile)
const resolve = require(`path`).resolve
const gitSemverTags = require('git-semver-tags')
module.exports = Q.all([
  readFile(resolve(__dirname, `./templates/template.hbs`), `utf-8`),
  readFile(resolve(__dirname, `./templates/header.hbs`), `utf-8`),
  readFile(resolve(__dirname, `./templates/commit.hbs`), `utf-8`),
  readFile(resolve(__dirname, `./templates/footer.hbs`), `utf-8`)
])
  .spread((template, header, commit, footer) => {
    const writerOpts = getWriterOpts()

    writerOpts.mainTemplate = template
    writerOpts.headerPartial = header
    writerOpts.commitPartial = commit
    writerOpts.footerPartial = footer

    return writerOpts
  })


// 从core拷贝的内容
function guessNextTag (previousTag, version) {
  if (previousTag) {
    if (previousTag[0] === 'v' && version[0] !== 'v') {
      return 'v' + version
    }

    if (previousTag[0] !== 'v' && version[0] === 'v') {
      return version.replace(/^v/, '')
    }

    return version
  }

  if (version[0] !== 'v') {
    return 'v' + version
  }

  return version
}

// 从core拷贝的内容
// core的finalizeContext，自定义会覆盖掉，所以拷贝出来，先调用
function finalizeContext (context, writerOpts, filteredCommits, keyCommit, originalCommits) {
  var firstCommit = originalCommits[0]
  var lastCommit = originalCommits[originalCommits.length - 1]
  var firstCommitHash = firstCommit ? firstCommit.hash : null
  var lastCommitHash = lastCommit ? lastCommit.hash : null

  if ((!context.currentTag || !context.previousTag) && keyCommit) {
    var match = /tag:\s*(.+?)[,)]/gi.exec(keyCommit.gitTags)
    var currentTag = context.currentTag
    context.currentTag = currentTag || match ? match[1] : null
    var index = gitSemverTags.indexOf(context.currentTag)

    // if `keyCommit.gitTags` is not a semver
    if (index === -1) {
      context.currentTag = currentTag || null
    } else {
      var previousTag = context.previousTag = gitSemverTags[index + 1]
      if (!previousTag) {
        context.previousTag = context.previousTag || lastCommitHash
      }
    }
  } else {
    context.previousTag = context.previousTag || gitSemverTags[0]

    if (context.version !== 'Unreleased' && !context.currentTag) {
      context.currentTag = guessNextTag(gitSemverTags[0], context.version)
    }
  }

  if (!context.linkCompare && context.previousTag && context.currentTag) {
    context.linkCompare = true
  }
  return context
}

function getWriterOpts () {
  return {
    transform: (commit, context) => {
      let discard = true
      const issues = []

      commit.notes.forEach(note => {
        note.title = `BREAKING CHANGES`
        discard = false
      })
      if (commit.type === `feat`) {
        commit.type = `Features`
      } else if (commit.type === `fix`) {
        commit.type = `Bug Fixes`
      } else if (commit.type === `perf`) {
        commit.type = `Performance Improvements`
      } else if (commit.type === `revert`) {
        commit.type = `Reverts`
      } else if (discard) {
        return
      } else if (commit.type === `docs`) {
        commit.type = `Documentation`
      } else if (commit.type === `style`) {
        commit.type = `Styles`
      } else if (commit.type === `refactor`) {
        commit.type = `Code Refactoring`
      } else if (commit.type === `test`) {
        commit.type = `Tests`
      } else if (commit.type === `build`) {
        commit.type = `Build System`
      } else if (commit.type === `ci`) {
        commit.type = `Continuous Integration`
      }

      if (commit.scope === `*`) {
        commit.scope = ``
      }

      if (typeof commit.hash === `string`) {
        commit.hash = commit.hash.substring(0, 7)
      }

      if (typeof commit.subject === `string`) {
        let url = context.repository
          ? `${context.host}/${context.owner}/${context.repository}`
          : context.repoUrl
        if (url) {
          url = `${url}/issues/`
          // Issue URLs.
          commit.subject = commit.subject.replace(/#([0-9]+)/g, (_, issue) => {
            issues.push(issue)
            return `[#${issue}](${url}${issue})`
          })
        }
        if (context.host) {
          // User URLs.
          commit.subject = commit.subject.replace(/\B@([a-z0-9](?:-?[a-z0-9]){0,38})/g, `[@$1](${context.host}/$1)`)
        }
      }

      // remove references that already appear in the subject
      commit.references = commit.references.filter(reference => {
        if (issues.indexOf(reference.issue) === -1) {
          return true
        }

        return false
      })

      return commit
    },
    finalizeContext: function (_context, writerOpts, filteredCommits, keyCommit, originalCommits) {
      // 先调用core的处理
      const context = finalizeContext(_context, writerOpts, filteredCommits, keyCommit, originalCommits)
      // 生成上线版本
      // commit中带有feat: Online Operation Version
      // version没有，分组的commit group中有feature，且有上线字眼
      // 获取上线信息(上线版本，时间，人)，将
      let version, operator, date;
      for(const item of context.commitGroups) {
        if (item.title !== 'Features') {
          continue;
        }
        // console.log('features:', item.commits)
        for(let i=0; i<item.commits.length; i++) {
          const subject = item.commits[i].subject;
          if (subject.indexOf('Online Operation Version') !== -1) {
            // 找到版本的信息
            version = subject.match(/Version: (.*)Date:/)[1];
            operator = subject.match(/Operator:(.*)/)[1];
            date = subject.match(/Date: (.*)Operator:/)[1];
            // 删除这个commit
            item.commits.splice(i, 1);
            break;
          }
        }
      }
      if (version && operator && date) {
        // 找到上线字样
        if (!context.version) {
          // 新数据
          context.onlineInfo = {
            version,
            operator,
            date,
          };
        } else {
          // 历史数据
          context.onlineInfoHistory = {
            version,
            operator,
            date,
          };
        }
      }
      return context
    },
    groupBy: `type`,
    commitGroupsSort: `title`,
    commitsSort: [`scope`, `subject`],
    noteGroupsSort: `title`,
    notesSort: compareFunc
  }
}
