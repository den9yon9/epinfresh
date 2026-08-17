// 微信支付 APIv3 网关配置(仅代码层; 密钥由调用方从文件读取后传入 PEM 内容)
export interface WechatGatewayConfig {
  // 渠道端点: 真实 https://api.mch.weixin.qq.com; 开发期指向本地 pay-mock-server
  baseUrl: string
  merchantId: string
  appId: string
  // APIv3 密钥(32 字节 utf8), 用于回调资源 AES-256-GCM 解密
  apiV3Key: string
  // 商户证书序列号 + 商户私钥(PEM); 用于出站请求签名
  merchantSerialNo: string
  merchantPrivateKey: string
  // 微信支付平台公钥(PEM); 用于回调验签。
  // 真实环境可通过 /v3/certificates 定时拉取; 联调期从 pay-mock-server 的 /v3/certificates 获取
  platformPublicKey: string
  notifyUrl: string
}
