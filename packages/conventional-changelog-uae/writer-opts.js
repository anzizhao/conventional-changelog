'use strict'

const compareFunc = require(`compare-func`)
const Q = require(`q`)
const readFile = Q.denodeify(require(`fs`).readFile)
const resolve = require(`path`).resolve
const semverValid = require('semver').valid
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

function getWriterOpts () {
  return {
    generateOn: function (commit) {
      const v = semverValid(commit.version);
      if (v) return v;
      const subject = commit.subject; 
      if (subject && subject.indexOf('Online Operation Version') !== -1) {
        // 是上线版本记录
        return 'onlinemark';
      }
      return null;
    },
    transform: (commit, context) => {
      let discard = true
      const issues = []

      commit.notes.forEach(note => {
        note.title = `BREAKING CHANGES`
        discard = false
      })
      if (commit.type === `feat`) {
        commit.type = `Features`
      } else if (commit.type === `chore`) {
        commit.type = `Chores`
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
    finalizeContext: function (context, writerOpts, filteredCommits, keyCommit, originalCommits, options) {
      // 生成上线版本
      // commit中带有feat: Online Operation Version
      // version没有，分组的commit group中有feature，且有上线字眼
      // 获取上线信息(上线版本，时间，人)，将
      let version, operator, date;
      for(const item of context.commitGroups) {
        if (item.title !== 'Features' && item.title !== 'Chores') {
          continue;
        }
        // console.log('features:', item.commits)
        for(let i=0; i<item.commits.length; i++) {
          const subject = item.commits[i].subject;
          if (subject && subject.indexOf('Online Operation Version') !== -1) {
            // 找到版本的信息
            version = subject.match(/Version: (.*)Date:/)[1];
            operator = subject.match(/Operator:(.*)/)[1];
            date = subject.match(/Date: (.*)Operator:/)[1];
            // 删除这个commit
            item.commits.splice(i, 1);
            if (!item.commits.length) {
              // 本来只有一条上线记录，现在为空数组，将title删除掉
              item.title = '';
            }
            break;
          }
        }
      }
      if (version && operator && date) {
        if (options.releaseCount !== 0) {
          // 非全局替换
          // 新数据
          context.onlineInfo = {
            version,
            operator,
            date,
          };
        } else {
          // 历史数据,包含在下一个release里面
          context.onlineInfoHistory = {
            version,
            operator,
            date,
          };
        }

        // if (writerOpts.releaseCount !== 0) {
        //   // 非全局替换
        //   delete context.commitGroups;
        // }
        // // 找到上线字样
        // if (!context.version) {
        //   // 新数据
        //   context.onlineInfo = {
        //     version,
        //     operator,
        //     date,
        //   };
        // } else {
        //   // 如果是通过全局替换的，不是追加的，才会生成历史记录
        //   if (writerOpts.releaseCount === 0) {
        //     // 历史数据
        //     context.onlineInfoHistory = {
        //       version,
        //       operator,
        //       date,
        //     };
        //   }
        // }
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
