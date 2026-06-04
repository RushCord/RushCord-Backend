/**
 * Queue-based mock for docClient.send. Each test file must hoist:
 *
 *   const mockDocSend = jest.fn();
 *   jest.mock("../../src/lib/dynamodb", () => ({
 *     docClient: { send: mockDocSend },
 *     getTableName: jest.fn(() => "RushCordTest"),
 *   }));
 *
 * Then: const q = createSendQueue(mockDocSend);
 */
function createSendQueue(mockSend) {
  const queue = [];

  mockSend.mockReset();
  mockSend.mockImplementation(async () => {
    if (queue.length === 0) {
      return {};
    }
    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });

  return {
    push(...results) {
      queue.push(...results);
    },
    pushGet(item) {
      queue.push({ Item: item ?? undefined });
    },
    pushQuery(items) {
      queue.push({ Items: items ?? [] });
    },
  };
}

module.exports = { createSendQueue };
