import { Map } from 'immutable';

export interface HeroStatsProfile {
	heroCardId: string;
	deltaStatsPerTurn: Map<number, number>;
}
