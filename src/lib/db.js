/**
 * DynamoDB client wrapper.
 *
 * Uses AWS SDK v3 with the DynamoDBDocumentClient for clean JS object
 * marshalling/unmarshalling. The client is created once per Lambda cold start
 * and reused across warm invocations (module-level singleton pattern).
 *
 * For local dev, set DYNAMODB_ENDPOINT env var to http://localhost:8000.
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

// Build client config — override endpoint for local DynamoDB
const clientConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

if (process.env.DYNAMODB_ENDPOINT) {
  clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
  // When using a local endpoint, supply credentials explicitly so the SDK
  // doesn't waste time trying to reach the EC2 metadata service (IMDS).
  clientConfig.credentials = {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };
}

const ddbClient = new DynamoDBClient(clientConfig);

// DocumentClient translates JS objects to DynamoDB AttributeValue format
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true, // Strip undefined fields instead of throwing
    convertEmptyValues: false,
  },
});

const TABLE_NAME = process.env.URLS_TABLE || 'urls';

/**
 * Fetch a URL record by short code.
 * @param {string} shortCode
 * @returns {Promise<Object|null>} The item or null if not found.
 */
async function getUrl(shortCode) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { shortCode },
    })
  );
  return result.Item || null;
}

/**
 * Write a new URL record with conditional check to prevent overwrites.
 * Throws ConditionalCheckFailedException if the shortCode already exists.
 *
 * @param {Object} item - Full URL record to write.
 * @returns {Promise<void>}
 */
async function putUrl(item) {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      // Atomic collision guard — fails if the key already exists
      ConditionExpression: 'attribute_not_exists(shortCode)',
    })
  );
}

/**
 * Increment click count and update lastAccessedAt — fire-and-forget safe.
 * Uses ADD for atomic increment without a read-modify-write cycle.
 *
 * @param {string} shortCode
 * @returns {Promise<void>}
 */
async function incrementClickCount(shortCode) {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { shortCode },
      UpdateExpression: 'ADD clickCount :inc SET lastAccessedAt = :now',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':now': new Date().toISOString(),
      },
      // Only update if record exists (avoid creating ghost records)
      ConditionExpression: 'attribute_exists(shortCode)',
    })
  );
}

/**
 * Delete a URL record by short code.
 * Optionally scoped to an owner to prevent unauthorized deletions.
 *
 * @param {string} shortCode
 * @param {string} [ownerId] - If provided, adds ownership check.
 * @returns {Promise<void>}
 */
async function deleteUrl(shortCode, ownerId) {
  const params = {
    TableName: TABLE_NAME,
    Key: { shortCode },
    ConditionExpression: 'attribute_exists(shortCode)',
  };

  if (ownerId) {
    params.ConditionExpression += ' AND ownerId = :ownerId';
    params.ExpressionAttributeValues = { ':ownerId': ownerId };
  }

  await docClient.send(new DeleteCommand(params));
}

/**
 * Scan all URLs — for demo/admin use only.
 * In production, replace with a GSI-backed query.
 *
 * @param {string} [ownerId] - If provided, filter by owner.
 * @param {string} [lastKey] - Exclusive start key for pagination.
 * @param {number} [limit=50] - Max items to return.
 * @returns {Promise<{ items: Object[], lastKey?: Object }>}
 */
async function listUrls(ownerId, lastKey, limit = 50) {
  const params = {
    TableName: TABLE_NAME,
    Limit: Math.min(limit, 100), // Hard cap at 100
  };

  if (lastKey) {
    params.ExclusiveStartKey = lastKey;
  }

  if (ownerId) {
    params.FilterExpression = 'ownerId = :ownerId';
    params.ExpressionAttributeValues = { ':ownerId': ownerId };
  }

  const result = await docClient.send(new ScanCommand(params));
  return {
    items: result.Items || [],
    lastKey: result.LastEvaluatedKey,
  };
}

module.exports = {
  getUrl,
  putUrl,
  incrementClickCount,
  deleteUrl,
  listUrls,
  TABLE_NAME,
};
