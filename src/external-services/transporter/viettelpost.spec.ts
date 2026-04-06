import { ViettelPost } from './viettelpost';
import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import { PriceEstimateReq } from './interface';

jest.mock('node-fetch');
jest.mock('../../plugins/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../config/viettelpost.config', () => ({
  viettelpostConfigs: {
    viettelpostUrl: 'https://test.viettelpost.vn/v2',
    viettelpostToken: 'mock-token',
    viettelpostUsername: '',
    viettelpostPassword: '',
  },
}));

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

/** Build a minimal mock node-fetch Response */
function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    statusText: status === 500 ? 'Internal Server Error' : 'OK',
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const baseReq: PriceEstimateReq = {
  weight: 500,
  value: 100000,
  serviceLevel: 'VCN',
  transport: 'road',
  from: {
    province: 'HCM',
    district: 'Q1',
    address: '123 Nguyen Hue',
  },
  to: {
    province: 'HN',
    district: 'HBT',
    address: '456 Le Duan',
  },
};

describe('ViettelPost.getPriceEstimate', () => {
  let viettelpost: ViettelPost;

  beforeEach(() => {
    jest.clearAllMocks();
    viettelpost = new ViettelPost({});
  });

  it('returns GIA_CUOC of the first price item on success', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        status: 200,
        error: false,
        message: '',
        data: [
          { MA_DV_CHINH: 'VCN', TEN_DICHVU: 'ViettelPost Express', GIA_CUOC: 35000, THOI_GIAN: '1' },
          { MA_DV_CHINH: 'V120', TEN_DICHVU: 'ViettelPost Standard', GIA_CUOC: 22000, THOI_GIAN: '2' },
        ],
      }),
    );

    const fee = await viettelpost.getPriceEstimate(baseReq);

    expect(fee).toBe(35000);
  });

  it('sends correct request body to the ViettelPost API', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        status: 200,
        error: false,
        message: '',
        data: [{ MA_DV_CHINH: 'VCN', TEN_DICHVU: '', GIA_CUOC: 20000, THOI_GIAN: '1' }],
      }),
    );

    await viettelpost.getPriceEstimate(baseReq);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test.viettelpost.vn/v2/order/getPriceAll');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string, string>)['Token']).toBe('mock-token');

    const sentBody = JSON.parse(options?.body as string);
    expect(sentBody).toMatchObject({
      PRODUCT_WEIGHT: 500,
      PRODUCT_PRICE: 100000,
      MONEY_COLLECTION: 0,
      ORDER_SERVICE: 'VCN',
      SENDER_PROVINCE: 'HCM',
      SENDER_DISTRICT: 'Q1',
      RECEIVER_PROVINCE: 'HN',
      RECEIVER_DISTRICT: 'HBT',
      PRODUCT_TYPE: 'HH',
      NATIONAL_TYPE: 1,
    });
  });

  it('defaults ORDER_SERVICE to VCN when serviceLevel is empty', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        status: 200,
        error: false,
        message: '',
        data: [{ MA_DV_CHINH: 'VCN', TEN_DICHVU: '', GIA_CUOC: 18000, THOI_GIAN: '1' }],
      }),
    );

    const fee = await viettelpost.getPriceEstimate({ ...baseReq, serviceLevel: '' });

    expect(fee).toBe(18000);
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(sentBody.ORDER_SERVICE).toBe('VCN');
  });

  it('returns 0 when data array is empty', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, { status: 200, error: false, message: '', data: [] }),
    );

    const fee = await viettelpost.getPriceEstimate(baseReq);

    expect(fee).toBe(0);
  });

  it('throws when HTTP status is 500', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, {}));

    await expect(viettelpost.getPriceEstimate(baseReq)).rejects.toThrow(
      'Internal Server Error',
    );
  });

  it('throws when API envelope status is not 200', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        status: 400,
        error: true,
        message: 'Thông tin không hợp lệ',
        data: null,
      }),
    );

    await expect(viettelpost.getPriceEstimate(baseReq)).rejects.toThrow(
      'Thông tin không hợp lệ',
    );
  });

  it('throws a generic message when API error has no message', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, { status: 500, error: true, message: '', data: null }),
    );

    await expect(viettelpost.getPriceEstimate(baseReq)).rejects.toThrow(
      'ViettelPost request failed',
    );
  });
});
