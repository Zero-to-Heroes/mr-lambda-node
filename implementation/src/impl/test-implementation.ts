import { MiniReview } from '../../../mr-lambda-common/src/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/src/models/reduce-output';
import { Implementation } from '../implementation';

export class TestImplementation implements Implementation {
	public async loadReviewIds(): Promise<readonly string[]> {
		throw new Error('Method not implemented.');
	}

	public async extractMetric(replayAsString: string, miniReview: MiniReview): Promise<any> {
		throw new Error('Method not implemented.');
	}

	public async mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput> {
		throw new Error('Method not implemented.');
	}
}
