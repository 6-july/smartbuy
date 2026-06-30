export default defineAppConfig({
  pages: ["pages/index/index", "pages/auth/index", "pages/chat/index"],
  // 同声传译权限暂未开通，先保留配置但不启用。
  // plugins: {
  //   WechatSI: {
  //     version: "0.3.5",
  //     provider: "wx069ba97219f66d99",
  //   },
  // },
  window: {
    navigationStyle: "custom",
    navigationBarTextStyle: 'black',
    navigationBarBackgroundColor: '#fff',
    backgroundColor: "#fff8f2",
  },
  // permission: {
  //   "scope.record": {
  //     desc: "用于语音输入商品咨询问题",
  //   },
  // },
});
