// 支付宝网关配置(仅代码层; 密钥由调用方从文件读取后传入 PEM 内容)
export interface AlipayGatewayConfig {
  // 网关端点: 真实 https://openapi.alipay.com; 开发期指向本地 pay-mock-server
  baseUrl: string
  // 应用 AppID
  appId: string
  // 应用私钥(PEM): 出站请求 RSA2 签名
  appPrivateKey: string
  // 支付宝公钥(PEM): 回调验签
  alipayPublicKey: string
  // 异步通知地址(支付结果回调)
  notifyUrl: string
}
