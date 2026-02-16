import { type ApiRequest, type ApiResponse, json } from '../_utils';
import {
  handlePairClaim,
  handlePairRevoke,
  handlePairStart,
  handlePairStatus,
} from './_handlers';

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' } },
};

const handlers: Record<string, (req: ApiRequest, res: ApiResponse) => Promise<void>> = {
  start: handlePairStart,
  claim: handlePairClaim,
  status: handlePairStatus,
  revoke: handlePairRevoke,
};

function getAction(req: ApiRequest): string {
  const raw = req.query?.action;
  const action = Array.isArray(raw) ? raw[0] : raw;
  return typeof action === 'string' ? action.trim().toLowerCase() : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const action = getAction(req);
  const routeHandler = handlers[action];

  if (!routeHandler) {
    json(res, 404, { error: 'Not found' });
    return;
  }

  await routeHandler(req, res);
}
