/**
 * 请求失败原因解释：结构化错误（errorCode/error/phase）→ 中文说明 + 排查建议
 * 参考 Postman / Apifox 的失败排查引导，供 ResponsePanel 失败视图渲染
 */

/** 失败阶段 → 中文标签 */
const PHASE_LABELS = {
  dns: 'DNS 解析',
  connect: '建立 TCP 连接',
  tls: 'TLS 握手',
  ttfb: '等待服务器响应',
  download: '接收响应数据'
};

/** 证书类错误码：可通过关闭 SSL 校验绕过（自签名/过期/域名不匹配等） */
const CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
]);

/**
 * 解释一次失败响应
 * @param response { error, errorCode, syscall, address, port, phase, ... }
 * @returns { code, title, phaseLabel, suggestions: string[], sslRelated: boolean }
 */
export function explainRequestError(response) {
  const code = response.errorCode || '';
  const msg = response.error || '';
  const target = response.address
    ? response.address + (response.port ? ':' + response.port : '')
    : '';
  const base = {
    code,
    phaseLabel: PHASE_LABELS[response.phase] || '',
    sslRelated: false
  };

  if (code === 'ECONNREFUSED') {
    return {
      ...base,
      title: `连接被拒绝${target ? `：${target} ` : ''}没有服务在监听`,
      suggestions: [
        '确认目标服务已启动，且监听的端口与 URL 中的端口一致',
        '检查 URL 的主机名 / 端口是否填写正确',
        '目标在远程机器时，确认防火墙或安全组放行了该端口'
      ]
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      ...base,
      title: `域名解析失败${target ? `：${target}` : ''}`,
      suggestions: [
        '检查 URL 中的域名拼写是否正确',
        '确认当前网络可以解析该域名（内网域名需在内网环境）',
        '需要走代理才能访问时，在请求「设置」页配置代理'
      ]
    };
  }
  if (code === 'REQ_TIMEOUT' || code === 'ETIMEDOUT') {
    return {
      ...base,
      title: '请求超时，服务器在限定时间内未响应',
      suggestions: [
        '确认目标服务可达（可先 ping 或用浏览器访问）',
        '接口本身较慢时，在请求「设置」页调大超时时间',
        '检查是否需要代理，或代理是否可用'
      ]
    };
  }
  if (code === 'ECONNRESET' || /socket hang up/i.test(msg)) {
    return {
      ...base,
      title: '连接被服务器提前断开',
      suggestions: [
        '检查协议是否匹配：对 HTTPS 服务用了 http://（或相反）',
        '服务器可能在处理中崩溃或主动断连，查看服务端日志',
        '请求体过大或 Header 非法时部分服务器会直接断开连接'
      ]
    };
  }
  if (code === 'EPROTO' || /wrong version number/i.test(msg)) {
    return {
      ...base,
      title: 'TLS 协议错误，对方可能不是 HTTPS 服务',
      suggestions: [
        '确认 URL 协议：对普通 HTTP 端口使用 https:// 会导致该错误',
        '确认目标端口提供的是 TLS 服务'
      ]
    };
  }
  if (CERT_CODES.has(code)) {
    return {
      ...base,
      sslRelated: true,
      title: 'SSL 证书校验失败',
      suggestions: [
        '目标使用自签名 / 过期 / 域名不匹配的证书',
        '测试环境可在请求「设置」页关闭 SSL 证书校验，或点击下方按钮直接重试',
        '生产环境建议修复服务端证书而不是跳过校验'
      ]
    };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return {
      ...base,
      title: `网络不可达${target ? `：${target}` : ''}`,
      suggestions: [
        '检查本机网络连接与路由（VPN / 内网环境是否已连接）',
        '确认目标 IP 段是否需要通过代理访问'
      ]
    };
  }
  if (code === 'PROXY_ERROR') {
    return {
      ...base,
      title: '代理连接失败',
      suggestions: [
        '检查请求「设置」页中代理地址与端口是否正确',
        '确认代理服务可用，需要认证时在代理 URL 中携带账号密码',
        '不需要代理时清空代理配置后重试'
      ]
    };
  }
  if (code === 'REQ_CANCELED') {
    return { ...base, title: '请求已被手动取消', suggestions: [] };
  }
  if (code === 'TOO_MANY_REDIRECTS') {
    return {
      ...base,
      title: '重定向次数过多',
      suggestions: [
        '服务端可能存在循环重定向，查看下方重定向链路定位',
        '可在请求「设置」页关闭自动跟随重定向，逐跳排查'
      ]
    };
  }
  if (code === 'BAD_URL') {
    return {
      ...base,
      title: 'URL 格式非法',
      suggestions: [
        '确认 URL 以 http:// 或 https:// 开头且格式完整',
        '使用变量时确认变量已在当前环境中定义（未定义的 {{var}} 不会被替换）'
      ]
    };
  }
  if (code === 'BAD_MULTIPART') {
    return {
      ...base,
      title: 'multipart 表单构建失败',
      suggestions: ['检查 form-data 中文件类型字段的文件路径是否存在且可读']
    };
  }
  if (code === 'BAD_GRAPHQL_VARS') {
    return {
      ...base,
      title: 'GraphQL Variables 不是合法 JSON',
      suggestions: ['检查 Variables 输入框中的 JSON 语法']
    };
  }
  if (/^HPE_/.test(code)) {
    return {
      ...base,
      title: '响应不是合法的 HTTP 报文',
      suggestions: [
        '目标端口可能不是 HTTP 服务（如数据库 / 自定义协议端口）',
        '确认 URL 端口正确'
      ]
    };
  }
  // 兜底：展示原文 + 通用排查
  return {
    ...base,
    title: '请求发送失败',
    suggestions: [
      '查看下方原始错误信息定位原因',
      '确认 URL、代理、证书等配置正确后重试',
      '打开控制台查看完整请求日志'
    ]
  };
}
