BEGIN;
TRUNCATE "Collections", "CollectionMembers", "CollectionInvites", "ChangeSets", "AnnotationGroups", "Annotations", "CellCounts", "RegionsOfInterest", "ImageAdjustments";
COMMIT;
