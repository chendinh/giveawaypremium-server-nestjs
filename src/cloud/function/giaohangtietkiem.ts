import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import { ghtkConfigs } from '../../config/ghtk.config';
const { ghtkToken, ghtkUrl } = ghtkConfigs;
export const giaohangtietkiem = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any> => {
  const { params } = request;
  const { method, path, data } = params;

  const url = method === 'GET' ? `${ghtkUrl}${path}?${new URLSearchParams(data)}` : `${ghtkUrl}${path}`;
  const body = method === 'GET' ? undefined : data;
  const result = await fetch(url, { method: 'POST', body, headers: { Token: ghtkToken} });
  const json = await result.json();

  return { ...json, tranporter: 'GHTK' };
};
