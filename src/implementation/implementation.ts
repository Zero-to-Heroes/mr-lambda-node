import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BgsAvgStatsPerTurnPerHero } from './impl/battlegrounds-avg-stats-per-turn-per-hero';

export interface Implementation {
	loadReviewIds(query: string): Promise<readonly string[]>;
	extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any>;
	mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput>;
	transformOutput(output: ReduceOutput): Promise<ReduceOutput>;
}

// const currentImplementation: Implementation = new BgsAvgStatsPerTurnPerFinalPosition();
// const currentImplementation: Implementation = new BgsAvgStatsPerTurn();
// const currentImplementation: Implementation = new BgsAvgStatsPerTurnPerHero();
// const currentImplementation: Implementation = new BuildAiDecklists();
// const currentImplementation: Implementation = new GalakrondDamageToHero();
// const currentImplementation: Implementation = new GalakrondMinionsKilled();

export const getImplementation = (implementationId: string): Implementation => {
	switch (implementationId) {
		// case 'heroes-tribe-comp':
		// 	return new BgsHeroesTribe();
		default:
			return new BgsAvgStatsPerTurnPerHero();
	}
};
