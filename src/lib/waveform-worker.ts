/// <reference lib="webworker" />

interface WorkerInput {
	ch0Buffer: ArrayBuffer;
	ch1Buffer: ArrayBuffer | null;
	pcmLen: number;
	duration: number;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
	const { ch0Buffer, ch1Buffer, pcmLen, duration } = e.data;

	const ch0 = new Float32Array(ch0Buffer);
	const ch1 = ch1Buffer ? new Float32Array(ch1Buffer) : null;
	const samples = Math.min(360000, Math.ceil(duration * 600));
	const data = new Float32Array(samples);

	for (let i = 0; i < samples; i++) {
		const startPcm = Math.floor((i * pcmLen) / samples);
		const endPcm = Math.floor(((i + 1) * pcmLen) / samples);
		let sum = 0;
		for (let j = startPcm; j < endPcm; j++) {
			const s = ch1 ? (ch0[j] + ch1[j]) * 0.5 : ch0[j];
			sum += s * s;
		}
		const count = endPcm - startPcm;
		data[i] = count > 0 ? Math.sqrt(sum / count) : 0;
		if (i % 10000 === 9999) {
			self.postMessage({ type: 'progress', progress: (i + 1) / samples });
		}
	}

	let maxVal = 0;
	for (let i = 0; i < data.length; i++) if (data[i] > maxVal) maxVal = data[i];
	if (maxVal > 0) for (let i = 0; i < data.length; i++) data[i] /= maxVal;

	self.postMessage({ type: 'done', data }, [data.buffer]);
};
