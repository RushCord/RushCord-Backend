function createMockReq({
  body = {},
  headers = {},
  user,
  cognitoSub,
  accessToken,
  params = {},
  query = {},
} = {}) {
  return {
    body,
    headers,
    user,
    cognitoSub,
    accessToken,
    params,
    query,
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
  };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  res.setHeader = jest.fn((name, value) => {
    res.headers[name] = value;
    return res;
  });
  return res;
}

module.exports = { createMockReq, createMockRes };
