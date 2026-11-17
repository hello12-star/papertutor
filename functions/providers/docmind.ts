import { readEnv } from "./env.ts";
import { ProviderError } from "./errors.ts";
import type { ParserProvider } from "./types.ts";

export function createDocmindProvider(): ParserProvider {
  return {
    id: "docmind",
    async parse() {
      const accessKeyId = readEnv("ALIYUN_ACCESS_KEY_ID");
      const accessKeySecret = readEnv("ALIYUN_ACCESS_KEY_SECRET");
      if (!accessKeyId || !accessKeySecret) {
        throw new ProviderError(
          "DOCMIND_NOT_CONFIGURED",
          "缺少 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET，未发起外网请求。",
          503,
        );
      }
      // M0 已用测试凭证验证 POST + HMAC-SHA1 签名链路；真实提交/轮询在 M1-C 接入。
      throw new ProviderError(
        "PARSER_NOT_IMPLEMENTED",
        "DocMind 真实解析尚未接入；请设置 PARSER_PROVIDER=mock 使用 mock 链路。",
        501,
      );
    },
  };
}