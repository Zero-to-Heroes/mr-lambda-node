/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { formatDate } from '../../../mr-lambda-common/services/utils';
import { Implementation } from '../../implementation';
import { loadBgReviewIds, loadMergedOutput } from './../battlegrounds-implementation-common';
import { BgsHeroesTribe } from './bgs-heroes-tribe';
import { BgsCombatWinrate } from './bgs-turn-winrate-per-hero';
import { BgsWarbandStats } from './bgs-warband-stats';

type SupportedGroups = BgsWarbandStats | BgsCombatWinrate | BgsHeroesTribe;

export class BattlegroundsGroupedQueries implements Implementation<any> {
	private implementations: readonly SupportedGroups[];
	private allKeys: string[];
	private jobName = 'battlegrounds-grouped-queries';
	private maxReviews = 50000;

	constructor() {
		this.implementations = [new BgsWarbandStats(), new BgsCombatWinrate(), new BgsHeroesTribe()];
		this.allKeys = this.implementations.map(impl => impl.getImplementationKey());
	}

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		return loadBgReviewIds(query, this.jobName, this.maxReviews);
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		// It is "any" because of the tribes, which returns "any"
		const results: readonly ImplementationResult[] = await Promise.all(
			this.implementations.map(
				async implementation =>
					({
						key: implementation.getImplementationKey(),
						data: await implementation.extractMetric(replay, miniReview, replayXml),
					} as ImplementationResult),
			),
		);

		const result: IntermediaryResult = {} as IntermediaryResult;
		results.forEach(implentationResult => {
			result[implentationResult.key] = implentationResult.data;
		});
		console.log('result', JSON.stringify(result, null, 4));
		return result;
	}

	public async mergeReduceEvents<IntermediaryResult>(
		inputResult: ReduceOutput<IntermediaryResult>,
		newResult: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		if (!inputResult || !inputResult.output) {
			console.log('currentResult is null', JSON.stringify(newResult, null, 4));
			return newResult;
		}
		if (!newResult || !newResult.output) {
			console.log('newResult is null', JSON.stringify(inputResult, null, 4));
			return inputResult;
		}

		const currentResult = {
			output: inputResult.output || {},
		} as ReduceOutput<IntermediaryResult>;

		const output: IntermediaryResult = {} as IntermediaryResult;
		for (const key of this.allKeys) {
			// console.log('merging', key, currentResult.output[key], newResult.output[key]);
			output[key] = await this.getImplementation(key).mergeIntermediaryResults(
				currentResult.output[key] || [],
				newResult.output[key] || [],
			);
			// console.log('merged', output[key]);
		}

		// console.log('returning', output);
		return {
			output: output,
		} as ReduceOutput<IntermediaryResult>;
	}

	public async transformOutput<IntermediaryResult>(
		output: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		console.log('transforming output', output);
		const mergedOutput: ReduceOutput<IntermediaryResult> = await loadMergedOutput(
			this.jobName,
			output,
			(currentResult, newResult) => this.mergeReduceEvents(currentResult, newResult),
		);
		console.log('merged output', mergedOutput);

		const periodDate = formatDate(new Date());
		const mysql = await getConnection();

		for (const key of this.allKeys) {
			const resultToSave = mergedOutput.output[key];
			await this.getImplementation(key).saveInDb(periodDate, resultToSave, mysql);
		}

		return mergedOutput;
	}

	private getImplementation(key: string): SupportedGroups {
		return this.implementations.find(impl => impl.getImplementationKey() === key);
	}
}

interface IntermediaryResult {
	[implementationKey: string]: any;
}

interface ImplementationResult {
	key: string;
	data: any;
}
