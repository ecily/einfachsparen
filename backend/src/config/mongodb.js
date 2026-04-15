const mongoose = require('mongoose');
const env = require('./env');

let isConnected = false;

async function connectToDatabase() {
  if (isConnected) {
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });

  isConnected = true;
  return mongoose.connection;
}

function getDatabaseState() {
  const connection = mongoose.connection;

  return {
    readyState: connection.readyState,
    host: connection.host,
    name: connection.name,
    models: Object.keys(connection.models),
  };
}

module.exports = {
  connectToDatabase,
  getDatabaseState,
};
