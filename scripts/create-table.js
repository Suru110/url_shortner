'use strict';

const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region:   'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
});

async function ensureTable(def) {
  try {
    await client.send(new CreateTableCommand(def));
    console.log(`✅ Created: ${def.TableName}`);
  } catch (e) {
    if (e.name === 'ResourceInUseException') {
      console.log(`   Already exists: ${def.TableName}`);
    } else {
      throw e;
    }
  }
}

async function setup() {
  // urls table
  await ensureTable({
    TableName: 'urls-local',
    AttributeDefinitions: [{ AttributeName: 'shortCode', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'shortCode', KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
    TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
  });

  // users table with email GSI
  await ensureTable({
    TableName: 'users-local',
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'email',  AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: [{
      IndexName: 'email-index',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
    }],
  });

  console.log('\nAll tables ready.');
}

setup().then(() => process.exit(0)).catch(e => {
  console.error('❌', e.message);
  // Show helpful message if DynamoDB not reachable
  if (e.code === 'ECONNREFUSED' || e.message.includes('connect')) {
    console.error('\nDynamoDB Local is not running. Start it with:\n  npm run db:start\n');
  }
  process.exit(1);
});
