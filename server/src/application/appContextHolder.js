// 全局 appContext 持有者。请求处理器从这里读取服务实例；
// 具体由运行环境（Node：appContext.js，Cloudflare：cloudflare/worker.mjs）在启动时填充。
const appContext = {}

function setAppContext(context) {
  Object.keys(appContext).forEach((key) => {
    delete appContext[key]
  })
  Object.assign(appContext, context)
  return appContext
}

module.exports = { appContext, setAppContext }
