'use strict';

/**
 * db.js — DynamoDB wrapper with automatic local fallback.
 *
 * If USE_LOCAL_DB=true (set automatically by server.js in dev),
 * uses localDb.js (JSON file on disk) instead of DynamoDB.
 * This means NO Docker and NO AWS needed for local development.
 */

// ── Local JSON store (dev) ────────────────────────────────────────────────────
if (process.env.USE_LOCAL_DB === 'true') {
  module.exports = require('./localDb');
  return;
}

// ── DynamoDB (production / SAM) ───────────────────────────────────────────────
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const clientConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

if (process.env.DYNAMODB_ENDPOINT) {
  clientConfig.endpoint    = process.env.DYNAMODB_ENDPOINT;
  clientConfig.credentials = {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };
}

const ddbClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

const TABLE_NAME = process.env.URLS_TABLE || 'urls';

async function getUrl(shortCode) {
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { shortCode } }));
  return result.Item || null;
}

async function putUrl(item) {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(shortCode)',
  }));
}

async function incrementClickCount(shortCode) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { shortCode },
    UpdateExpression: 'ADD clickCount :inc SET lastAccessedAt = :now',
    ExpressionAttributeValues: { ':inc': 1, ':now': new Date().toISOString() },
    ConditionExpression: 'attribute_exists(shortCode)',
  }));
}

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

async function listUrls(ownerId, lastKey, limit = 50) {
  const params = { TableName: TABLE_NAME, Limit: Math.min(limit, 100) };
  if (lastKey)  params.ExclusiveStartKey = lastKey;
  if (ownerId) { params.FilterExpression = 'ownerId = :ownerId'; params.ExpressionAttributeValues = { ':ownerId': ownerId }; }
  const result = await docClient.send(new ScanCommand(params));
  return { items: result.Items || [], lastKey: result.LastEvaluatedKey };
}

module.exports = { getUrl, putUrl, incrementClickCount, deleteUrl, listUrls, TABLE_NAME };
