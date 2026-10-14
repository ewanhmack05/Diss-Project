// A named set of annotations inside one collection - see annotation-store's
// Annotations/AnnotationGroup.cs. One level, and an annotation is in at most
// one (its groupId).
interface AnnotationGroup {
	id: string;
	collectionId: string;
	name: string;
	notes: string;
	created: string;
}

export type { AnnotationGroup };
