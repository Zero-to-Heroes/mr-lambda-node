import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { TestImplementation } from './impl/test-implementation';

export interface Implementation {
	mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput>;
	loadReviewIds(): Promise<readonly string[]>;
	extractMetric(replay: Replay, miniReview: MiniReview): Promise<any>;
}

const currentImplementation: Implementation = new TestImplementation();

export { currentImplementation as implementation };
