# Background

A look into the background, and a list of possible citation sources and other papers:

### Web Processing

An Introduction to Desktop Application Development for Real-time Image Processing with Web Camera: https://www.jstage.jst.go.jp/article/jjrt/80/1/80_2024-2302/_pdf

Real-time Video Processing in Web Applications: https://rochi.utcluj.ro/articole/3/RoCHI-2015-Ionita.pdf

SignalR real-time application cookbook: https://ebookcentral.proquest.com/lib/ljmu/reader.action?docID=1582946&query=&c=RVBVQg&ppg=1

WebSocket Essentials – Building Apps with HTML5 WebSockets: https://learning.oreilly.com/library/view/websocket-essentials-building/9781784396756/index.html

### Keycloak:

Keycloak - Identity and Access Management for Modern Applications: http://learning.oreilly.com/library/view/keycloak-identity/9781804616444/Text/Preface.xhtml

Applying Spring Security Framework with KeyCloak-Based OAuth2 to Protect Microservice Architecture APIs: https://mdpi-res.com/sensors/sensors-22-01703/article_deploy/sensors-22-01703-v2.pdf?version=1646020803

### Azure

Building your first Azure Static Web Application: https://www.proquest.com/docview/2408684545?pq-origsite=primo&accountid=12118&sourcetype=Trade%20Journals

Run containers on Azure App Service: https://www.proquest.com/docview/2489906537?pq-origsite=primo&accountid=12118&sourcetype=Trade%20Journals

### Version Control

Database Version Control - A Software Configuration Management Approach to Database Version Control: https://www.researchgate.net/publication/220738264_Database_Version_Control_-_A_Software_Configuration_Management_Approach_to_Database_Version_Control

Temporal and Real-Time Databases: https://experts.arizona.edu/en/publications/temporal-and-real-time-databases-a-survey/

Version Control Data Management: https://guides.library.ucdavis.edu/data-management/version-control

### Viewer/Wholeslide images

Efficient Visualization of Whole Slide Images in Web-based Viewers for Digital Pathology: https://pubmed.ncbi.nlm.nih.gov/34979569/

Standardized Clinical Annotation of Digital Histopathology Slides at the Point of Diagnosis: https://www.sciencedirect.com/science/article/pii/S0893395223002028

Digital pathology in tau research: A comparison of QuPath and HALO: https://pubmed.ncbi.nlm.nih.gov/40238207/

Halo: https://indicalab.com/halo/

QuPath: https://qupath.github.io/

Sectra: https://medical.sectra.com/solutionarea/digital-pathology/

Collaborative viewers:
CytoBrowser: https://github.com/MIDA-group/CytoBrowser - https://ljmu.primo.exlibrisgroup.com/permalink/44JMU_INST/ilfgop/cdi_swepub_primary_oai_DiVA_org_uu_457604

PathCollab: https://github.com/PABannier/PathCollab

Pathhub: https://pathhub.com/pages/pathhub-digital

PathVU: https://www.prr.ai/pathvu/

### Ai tailored source control

Redesigning source control at Anthropic: https://www.anthropic.com/research/redesigning-source-control


### Reading
- Collaborative web-based WSI
  - CytoBrowser (F1000Research 2021) - read, see [Read and noted](#read-and-noted): https://f1000research.com/articles/10-226/v1/pdf
  - Cytomine (Bioinformatics 2016): https://europepmc.org/articles/PMC4848407?pdf=render
  - Rich internet application for collaborative annotation, the first Cytomine paper (Diagnostic Pathology 2013) - read, see [Read and noted](#read-and-noted): https://diagnosticpathology.biomedcentral.com/track/pdf/10.1186/1746-1596-8-S1-S26
  - EXACT (Sci Rep 2021): https://www.nature.com/articles/s41598-021-83827-4.pdf
  - xOpat (Computer Graphics Forum 2023) - read, see [Read and noted](#read-and-noted): https://diglib.eg.org/bitstream/handle/10.1111/cgf14812/v42i3pp063-073_cgf14812.pdf
  - PIMIP (arXiv 2021) - read, see [Read and noted](#read-and-noted): https://arxiv.org/pdf/2111.05794
  - HistoColAi (arXiv 2023): https://arxiv.org/pdf/2307.07525
  - Role-Based Architecture for Secure Management of Telepathology Sessions (2020), landing page only: https://ebooks.iospress.nl/doi/10.3233/SHTI200243
  - Digital Slide Archive (Cancer Research 2017), landing page only: https://pmc.ncbi.nlm.nih.gov/articles/PMC5898232/
  - caMicroscope / QuIP (Cancer Research 2017), landing page only: https://pmc.ncbi.nlm.nih.gov/articles/PMC5987533/

- QuPath
  - QuPath original paper (Sci Rep 2017): https://www.nature.com/articles/s41598-017-17204-5.pdf
  - QuPath and OMERO (arXiv 2026): https://arxiv.org/pdf/2603.15702
  - SlideRunner (arXiv 2018): https://arxiv.org/pdf/1802.02347

- HALO
  - QuPath vs HALO comparison (bioRxiv 2025, preprint): https://www.biorxiv.org/content/10.1101/2025.05.16.654590.full.pdf
  - 14-tool comparison including QuPath and HALO (Technologies 2025): https://mdpi-res.com/d_attachment/technologies/technologies-13-00110/article_deploy/technologies-13…


### Read and noted

Four collaborative whole-slide viewers, read with highlights and margin notes.
What each one gives the write-up, and where its ideas went in these docs.

**1. Marée R, Stévens B, Rollus L, Rocks N, Moles Lopez X, Salmon I, Cataldo D,
Wehenkel L. "A rich internet application for remote visualization and
collaborative annotation of digital slides in histology and cytology."
_Diagnostic Pathology_ 8(Suppl 1):S26, 2013.** DOI 10.1186/1746-1596-8-S1-S26.
The first Cytomine paper.

- Web viewer on OpenLayers, a REST API over PostgreSQL with PostGIS, Grails on
  the server, slides read through OpenSlide (Aperio SVS, Hamamatsu VMS, 3DHistech
  Mirax and more). Every resource has its own URL, so other programs can use the
  API too.
- Each user draws on their own layer of annotations (polygons, ellipses,
  rectangles, freehand), and sees other people's on top.
- Collaboration was two things: an e-mail mechanism to share and discuss
  annotations, and following another user's observation path live over the
  internet. That's real-time following in 2013, years before most of the
  tools below.
- Annotations are tagged with terms from a per-project ontology, and a
  content-based image retrieval step suggests the term in about 500 ms from
  similar regions other users have already annotated.
- Used for: the per-user layer idea in
  [thought-process.md](thought-process.md#shared-vs-personal), where messaging
  came from in [messaging.md](messaging.md#in-other-viewers), hover for details in
  [todo.md](todo.md#12-ideas-from-the-reading).

**2. Horák J, Furmanová K, Kozlíková B, Brázdil T, Holub P, Kačenga M, Gallo M,
Nenutil R, Byška J, Rusňák V. "xOpat: eXplainable Open Pathology Analysis Tool."
_Computer Graphics Forum_ 42(3):63-73, 2023 (EuroVis 2023).** DOI 10.1111/cgf.14812.

- A modular, "protocol-agnostic" viewer: it talks to any image server by
  speaking that server's API, through handlers, rather than making the data
  move into one format. Core, modules (libraries such as WebGL rendering) and
  plugins (apps on top).
- Built for AI output: heat maps, probability layers and explainability layers
  drawn as WebGL shader layers over the tissue, with a live GLSL editor.
- Collaboration is sharing a session, not working in one together: the viewer's
  state goes out as a URL or an exported HTML file, and the Presenter plugin
  records a story of views. Their related work says synchronous collaboration
  is "supported less often", and xOpat doesn't do it either.
- Annotation presets on each mouse button, two windows that move together, an
  automatic outline mode.
- The intro is the motivation worth quoting: AI for pathology is held back by
  limited options for collaboration between researchers and clinicians, and
  clinicians end up using several viewers.
- Used for: tile combining and shader layers in
  [rendering.md](rendering.md#ideas-from-xopat), protocol-agnostic data providers
  in [tiler.md](breakdown/tiler.md#11-more-formats-and-more-than-one-tiler), the
  interaction ideas in [todo.md](todo.md#12-ideas-from-the-reading).

**3. Wu J, Mao A, Bao X, Zhang H, Gao Z, Wang C, Gong T, Li C. "PIMIP: An Open
Source Platform for Pathology Information Management and Integration."
arXiv:2111.05794, 2021.**

- A platform rather than a viewer: slides, clinical text and ML analysis in
  one place. OpenSeadragon in the browser, OpenSlide behind it.
- Multi-user collaborative annotation, with everyone's annotations on a slide
  stored together in its database, and multi-device annotation (mouse on a
  computer, stylus on a tablet). Undo, erase and clear for mistakes.
- Machine learning for automatic annotation, such as nucleus centres and
  boundaries.
- Useful line for the background: OpenSlide stores a slide as a pyramid so it
  can give "efficient and random access" to any part at any resolution - the
  reason a tiler can serve one tile without reading the whole slide.

**4. Rydell C, Lindblad J. "CytoBrowser: a browser-based collaborative annotation
platform for whole slide images." _F1000Research_ 10:226, 2021 (version 1).**
DOI 10.12688/f1000research.51916.1.
Peer review at version 1: one "approved with reservations", one "not approved",
so it carries less weight as a citation than the others.

- The closest to this project. A fork of TissUUmaps on OpenSeadragon, Node.js
  and Express on the server, and a WebSocket sending JSON messages for the
  collaboration. Any change one user makes is seen by the others live, people
  see each other's cursors, and can lock their view to follow someone.
- Built for cytology, so focal-plane z-stacks are a central requirement. Each
  z-layer is its own Deep Zoom Image (DZI) file named `imagename_zNNN.dzi`.
- Three ways to save: autosave to the server, a manual save to the server with
  a "simple versioning system" (save over the latest version of the file or
  make a new one), and export/import as JSON on your own machine.
- A gallery of thumbnails to pick an image, with a zoomed-in preview on hover.
- Intro gives the use cases: the main one is reaching slides over the internet
  from anywhere; the second is teaching, where a mixed methods trial found
  students who annotated together understood key features better than those
  who annotated alone (Sahota et al. 2016, below).
- Used for: the z-stack background in [zstack.md](zstack.md#2-two-kinds-of-depth),
  the gallery in [gallery.md](gallery.md#in-other-viewers), DZI and format
  conversion in [tiler.md](breakdown/tiler.md#11-more-formats-and-more-than-one-tiler).

#### How they compare

| | Cytomine 2013 | xOpat 2023 | PIMIP 2021 | CytoBrowser 2021 | This project |
| --- | --- | --- | --- | --- | --- |
| Map library | OpenLayers | OpenSeadragon + own WebGL | OpenSeadragon | OpenSeadragon (TissUUmaps fork) | OpenLayers, WebGL layers |
| Server | Grails, PostgreSQL + PostGIS, REST | Any image server, through handlers | Not named | Node.js, Express | .NET services, PostgreSQL |
| Working together | Follow someone live, e-mail annotations | Share a session as a URL or HTML file, stories | Multi-user annotation in one database | Live edits, cursors, follow someone | Live edits through a SignalR hub, viewports, Follow/Present, chat and messages |
| Keeping versions | Not described | Not described | Undo while drawing | Whole file: save over it or save a new copy | Every change kept in change sets, with who, from and to; put back one change, one row or a whole collection |
| Two people, same annotation | Not described | n/a (no live editing) | Not described | Not described | Per-field policy: merge text with Yjs, last or first change wins |
| Depth | No | Several slices as image layers, stacked or one at a time | No | Focal planes, one DZI per layer | Serial sections ([zstack.md](zstack.md)) |
| Formats | Through OpenSlide | Anything with a handler | SVS through OpenSlide | DZI, converted beforehand | `.mrxs` through OpenSlide |

"Not described" means the paper doesn't say - each was searched for version,
history, undo, conflict and concurrent. None of the four says what happens when
two people change the same annotation at once, and the only versioning is
CytoBrowser's whole-file copy that the user picks when saving. Who changed what,
and putting one change back, isn't in any of them. That's the gap the version
control work here fills, and the strongest way to set it against prior work.

#### Terms looked up

- **Disruptive technology** - xOpat calls whole-slide imaging one, citing
  Pantanowitz et al. 2015. The term is Christensen's: a technology that starts
  cheaper or simpler than what's there and ends up replacing it. Here, slides
  scanned once and viewed anywhere instead of glass under one microscope.
- **OpenSeadragon** - an open-source JavaScript viewer for deep-zoom images,
  the usual choice for web slide viewers (CytoBrowser, PIMIP, xOpat).
  This project uses OpenLayers instead, which is a map library that does the
  same tiled zooming plus vector drawing.
- **Revealing Module pattern** - a JavaScript pattern from before ES modules:
  wrap code in a function, keep everything private inside it, and return an
  object with only the parts meant to be public. CytoBrowser uses it to keep
  its parts apart. ES modules (`import`/`export`) do the same job now.
- **Deep Zoom Image (DZI)** - Microsoft's tile pyramid format: an XML file with
  the size and tile size, plus a folder of tiles per level. The same idea as
  the Zoomify URLs the tiler serves.
- **Bethesda system** - the standard categories for reporting cervical
  cytology (Nayar and Wilbur 2015). CytoBrowser uses it as its default
  annotation classes, swappable per task.
- **GLSL** - OpenGL Shading Language, the small programs WebGL runs on the GPU
  for each pixel. xOpat lets users write them live to change how a data layer
  is drawn.

#### Further citations found through them

- Pantanowitz L, Farahani N, Parwani A. "Whole slide imaging in pathology:
  advantages, limitations, and emerging perspectives." _Pathology and
  Laboratory Medicine International_ (2015), 23. DOI 10.2147/PLMI.S59826.
  For WSI as a disruptive technology.
- Sahota M, Leung B, Dowdell S, et al. "Learning pathology using collaborative
  vs. individual annotation of whole slide images: a mixed methods trial."
  _BMC Medical Education_ 16(1):311, 2016. For the teaching use case.
- Hanna MG, Monaco SE, Cuda J, et al. "Comparison of glass slides and various
  digital-slide modalities for cytopathology screening and interpretation."
  _Cancer Cytopathology_ 125(9):701-709, 2017. Z-stacks beat single-plane
  scans for cytology.
- Lu J, Sladoje N, Stark CR, et al. "A deep learning based pipeline for
  efficient oral cancer screening on whole slide images." ICIAR 2020,
  249-261. Being 0.8 µm off focus is enough to hurt a classifier.
- Marée R. "Open practices and resources for collaborative digital pathology."
  _Frontiers in Medicine_ 6:255, 2019. A survey by the Cytomine author, not read yet.


### Z stacking

- Mouse Colon Histology and IHC Dataset (Figshare 2026): https://figshare.com/articles/dataset/Mouse_colon_histology_and_IHC_whole-slide_image_dataset/32955…

- Registered H&E and Ki67 Histopathology Image Pairs (Data 2024): https://www.mdpi.com/2306-5729/9/8/100/pdf 

- Serial Section Histopathology Dataset (Mendeley): https://data.mendeley.com/datasets/fzskwpzs5j/1  — TIFF format, not MRXS.

- BigBrain Human Brain Histology: https://bigbrainproject.org/maps-and-models.html 

