import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BgsAvgStatsPerTurnPerHero } from './impl/battlegrounds-avg-stats-per-turn-per-hero';
import { BgsHeroesTribe } from './impl/bgs-heroes-tribe';

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
		case 'bgs-heroes-tribe':
			return new BgsHeroesTribe();
		case 'bgs-avg-stats-per-turn-per-hero':
			return new BgsAvgStatsPerTurnPerHero();
		default:
			throw new Error('Invalid implementation ' + implementationId);
	}
};
