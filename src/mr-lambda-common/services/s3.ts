import { S3 as S3AWS } from 'aws-sdk';

export class S3 {
	private readonly s3: S3AWS;

	constructor() {
		this.s3 = new S3AWS({ region: 'us-west-2' });
	}

	public async readContentAsString(bucketName: string, key: string): Promise<string> {
		return new Promise<string>(resolve => {
			const input = { Bucket: bucketName, Key: key };
			// console.log('getting s3 object', input);
			this.s3.getObject(input, (err, data) => {
				if (err) {
					console.error('could not read s3 object', bucketName, key, err);
					resolve(null);
					return;
				}
				const objectContent = data.Body.toString('utf8');
				// console.log('read object content', bucketName, key);
				resolve(objectContent);
			});
		});
	}

	public async writeFile(content: any, bucket: string, fileName: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const input = {
				Body: JSON.stringify(content),
				Bucket: bucket,
				Key: fileName,
				ACL: 'public-read',
				ContentType: 'application/json',
			};
			this.s3.upload(input, (err, data) => {
				if (err) {
					console.error('could not upload file to S3', input, err);
					resolve();
					return;
				}
				resolve();
			});
		});
	}
}
