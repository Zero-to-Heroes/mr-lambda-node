/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-var-requires */
import { SecretsManager } from 'aws-sdk';
import { GetSecretValueRequest, GetSecretValueResponse } from 'aws-sdk/clients/secretsmanager';
import { default as MySQLServerless, default as serverlessMysql } from 'serverless-mysql';

const secretsManager = new SecretsManager({ region: 'us-west-2' });
let mrConnection, mrConnectionPromise;

const mrConnect = async (): Promise<serverlessMysql.ServerlessMysql> => {
	const secretRequest: GetSecretValueRequest = {
		SecretId: 'rds-dev',
	};
	const secret: SecretInfo = await getMrSecret(secretRequest);
	const config = {
		host: secret.host,
		user: secret.username,
		password: secret.password,
		database: 'mr_log',
		port: secret.port,
	};
	mrConnection = MySQLServerless({ config });

	return mrConnection;
};

const getMrConnection = async (): Promise<serverlessMysql.ServerlessMysql> => {
	if (mrConnection) {
		return mrConnection;
	}
	if (mrConnectionPromise) {
		return mrConnectionPromise;
	}
	mrConnectionPromise = mrConnect();

	return mrConnectionPromise;
};

export { getMrConnection };

const getMrSecret = (secretRequest: GetSecretValueRequest) => {
	return new Promise<SecretInfo>(resolve => {
		secretsManager.getSecretValue(secretRequest, (err, data: GetSecretValueResponse) => {
			const secretInfo: SecretInfo = JSON.parse(data.SecretString);
			resolve(secretInfo);
		});
	});
};

interface SecretInfo {
	readonly username: string;
	readonly password: string;
	readonly host: string;
	readonly port: number;
	readonly dbClusterIdentifier: string;
}
