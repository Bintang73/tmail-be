import { isIpAllowed, normalizeClientIp } from '../services/accessControlService.js';

export const requireWhitelistedIp = async (req, res, next) => {
  try {
    const clientIp = normalizeClientIp(req.ip);
    if (await isIpAllowed(clientIp)) return next();

    return res.status(403).json({
      error: 'IP is not whitelisted',
      ip: clientIp
    });
  } catch (error) {
    return next(error);
  }
};
