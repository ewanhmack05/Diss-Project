BEGIN;
TRUNCATE "Collections", "CollectionMembers", "CollectionInvites", "AnnotationGroups", "Annotations", "CellCounts", "RegionsOfInterest", "ImageAdjustments", history."ChangeSets", history."Entries";
COMMIT;
