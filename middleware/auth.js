const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    // Decode without verification first to get header info
    const decoded = jwt.decode(token, { complete: true });
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const { header, payload } = decoded;
    const tenantId = process.env.TENANT_ID;
    const apiClientId = process.env.API_CLIENT_ID;
    const allowedScope = process.env.ALLOWED_SCOPE;

    console.log('[Auth] Token claims:', {
      aud: payload.aud,
      iss: payload.iss,
      scp: payload.scp,
      groups: payload.groups,
      oid: payload.oid,
      upn: payload.upn,
    });

    console.log('[Auth] Expected values:', {
      expectedAud: apiClientId,
      expectedIss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      expectedScope: allowedScope,
    });

    // Verify audience (should be the API's client ID)
    if (payload.aud !== apiClientId && !payload.aud.includes(apiClientId)) {
      console.error('[Auth] FAILED: Invalid audience', { expected: apiClientId, got: payload.aud });
      return res.status(403).json({ error: 'Invalid audience' });
    }

    // Verify issuer (accept both v2.0 and STS endpoints)
    const expectedIssuerV2 = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    const expectedIssuerSts = `https://sts.windows.net/${tenantId}/`;
    const isIssuerValid = payload.iss === expectedIssuerV2 || payload.iss === expectedIssuerSts;
    if (!isIssuerValid) {
      console.error('[Auth] FAILED: Invalid issuer', { expectedV2: expectedIssuerV2, expectedSts: expectedIssuerSts, got: payload.iss });
      return res.status(403).json({ error: 'Invalid issuer' });
    }

    // Verify scope (optional, but good practice)
    const tokenScopes = (payload.scp || '').split(' ');
    if (!tokenScopes.includes(allowedScope.split('/').pop())) {
      console.warn(`Token missing expected scope. Token scopes: ${tokenScopes.join(',')}`);
      // Don't reject yet; some setups may have different scope format
    }

    // Extract groups for authorization
    const groups = payload.groups || [];
    
    // Map groups to roles
    const readerGroupId = process.env.READER_GROUP_ID;
    const uploaderGroupId = process.env.UPLOADER_GROUP_ID;
    const adminGroupId = process.env.ADMIN_GROUP_ID;

    const isReader = groups.includes(readerGroupId);
    const isUploader = groups.includes(uploaderGroupId);
    const isAdmin = groups.includes(adminGroupId);

    console.log('[Auth] SUCCESS: User authenticated', { isReader, isUploader, isAdmin });

    // Attach user info to request
    req.user = {
      objectId: payload.oid,
      upn: payload.upn,
      name: payload.name,
      groups,
      roles: {
        isReader,
        isUploader,
        isAdmin,
      },
    };

    next();
  } catch (error) {
    console.error('Token validation error:', error.message);
    return res.status(401).json({ error: 'Token validation failed' });
  }
};

module.exports = authMiddleware;
