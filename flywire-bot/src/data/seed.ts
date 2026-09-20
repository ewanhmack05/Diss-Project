interface SeedNeuron {
	id: string;
	label: string;
	superClass: string;
	side: string | null;
	neurotransmitter: string | null;
	// Normalized to [0, 1] across the sampled set. x/y get projected into
	// whichever slide's real pixel dimensions the 2D bot is pointed at (see
	// annotationStore/payloads.ts), so the seed file itself stays
	// slide-agnostic. z is the neuron's real third dimension - unused by the
	// 2D slide overlay, consumed by the live 3D connectome view instead.
	x: number;
	y: number;
	z: number;
}

interface SeedConnection {
	preId: string;
	postId: string;
	synapses: number;
	neurotransmitter: string | null;
}

interface SeedFile {
	meta: {
		generatedAt: string;
		source: string;
		citation: string;
		neuronCount: number;
		connectionCount: number;
	};
	neurons: SeedNeuron[];
	connections: SeedConnection[];
}

export type { SeedNeuron, SeedConnection, SeedFile };
