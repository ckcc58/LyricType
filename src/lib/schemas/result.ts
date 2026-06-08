import { z } from 'zod';

const statusBit = z.union([z.literal(0), z.literal(1)]);

// chunk: [status, len] (uncommitted) | [status, len, 1] (committed)
const commitChunkV2 = z.union([
	z.tuple([statusBit, z.number().int().min(1)]),
	z.tuple([statusBit, z.number().int().min(1), z.literal(1)]),
]);

// phrase_result chunk: [status, len]
const phraseChunkV2 = z.tuple([statusBit, z.number().int().min(1)]);

// key_event: [code, t_ms] | [code, t_ms, flags]
// flags bitmask: bit0=shift, bit1=ctrl, bit2=alt, bit3=meta, bit4=ime, bit5=repeat
const keyEventV2 = z.union([
	z.tuple([z.string().max(40), z.number().int().min(0)]),
	z.tuple([z.string().max(40), z.number().int().min(0), z.number().int().min(1).max(63)]),
]);

// commit_event: [t, i, ch, c, p]
const commitEventV2 = z.tuple([
	z.number().int().min(0),
	z.number().int().min(0),
	z.array(z.array(commitChunkV2)),
	statusBit,
	statusBit,
]);

// phrase_result: [t, i, ch, c, p, sc, sp]
const phraseResultV2 = z.tuple([
	z.number().int().min(0),
	z.number().int().min(0),
	z.array(z.array(phraseChunkV2)),
	statusBit,
	statusBit,
	z.number().min(0).max(10000),
	z.number().min(0),
]);

export const resultSubmitSchema = z.object({
	chart_id:            z.number().int().positive(),
	lyric_data:          z.any(),
	chart_hash:          z.string().max(64),
	score:               z.number().min(0).max(10000),
	perfect_count:       z.number().int().min(0),
	reading_match_count: z.number().int().min(0),
	lost_count:          z.number().int().min(0),
	typing_speed:        z.number().min(0).max(2000),
	total_phrases:       z.number().int().min(0),
	key_events:     z.array(keyEventV2).max(5000),
	commit_events:  z.array(commitEventV2).max(10000),
	phrase_results: z.array(phraseResultV2).max(500),
});

export type ResultSubmitInput = z.infer<typeof resultSubmitSchema>;
