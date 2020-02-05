import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BuildAiDecklists } from './impl/build-ai-decklists';

export interface Implementation {
	transformOutput(output: ReduceOutput): Promise<ReduceOutput>;
	mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput>;
	loadReviewIds(query: string): Promise<readonly string[]>;
	extractMetric(replay: Replay, miniReview: MiniReview): Promise<any>;
}

const currentImplementation: Implementation = new BuildAiDecklists();
// const currentImplementation: Implementation = new GalakrondDamageToHero();
// const currentImplementation: Implementation = new GalakrondMinionsKilled();

export { currentImplementation as implementation };
