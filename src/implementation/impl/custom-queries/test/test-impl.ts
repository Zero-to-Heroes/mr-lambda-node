import { parseHsReplayString } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { DuelsPromoteEffects } from '../duels-promote-effects';
import { replayXml } from './replay.xml';

const test = async () => {
	const xml = replayXml;
	const replay = parseHsReplayString(xml);
	// Val'anyr (LETL_938_01), Snep Freeze 3 (LETL_933_03), Banner of the Horde 3 (LETL_751_03)
	const sut = new DuelsPromoteEffects();
	const output = await sut.extractMetric(replay, null);
	const output2 = await sut.extractMetric(replay, null);
	console.log(JSON.stringify(output, null, 4));
	const reduceOutput = await sut.mergeReduceEvents({ output: output }, { output: output2 });
	console.log(JSON.stringify(reduceOutput, null, 4));
};

test();
