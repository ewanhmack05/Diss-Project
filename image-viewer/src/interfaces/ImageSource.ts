interface StaticImageSource {
  kind: 'static'
  imagePath: string
}

interface TiledImageSource {
  kind: 'tiled'
  tilerUrl: string
  slideId: string
}

type ImageSource = StaticImageSource | TiledImageSource

export type { ImageSource, StaticImageSource, TiledImageSource }
