import { MiniReview } from '../../../mr-lambda-common/src/models/mini-review';
import { Implementation } from '../implementation';

export class TestImplementation implements Implementation {
	public async loadReviewIds(): Promise<readonly string[]> {
		throw new Error('Method not implemented.');
	}

	public async extractMetric(replayAsString: string, miniReview: MiniReview): Promise<any> {
		throw new Error('Method not implemented.');
	}
}
