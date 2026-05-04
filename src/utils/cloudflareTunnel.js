export const getCloudflareTunnelArgs = () => {
  const mode = process.env.CLOUDFLARE_TUNNEL_MODE || 'quick';
  const config = process.env.CLOUDFLARE_TUNNEL_CONFIG || '';
  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN || '';
  const name = process.env.CLOUDFLARE_TUNNEL_NAME || '';
  const url = process.env.CLOUDFLARE_TUNNEL_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

  if (token) {
    return ['tunnel', 'run', '--token', token];
  }

  if (config) {
    return ['tunnel', '--config', config, 'run', name].filter(Boolean);
  }

  if (mode === 'named' && name) {
    return ['tunnel', 'run', name];
  }

  return ['tunnel', '--url', url];
};
