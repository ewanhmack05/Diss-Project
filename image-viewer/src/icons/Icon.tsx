import './Icon.css'

interface IconProps {
  // An icon file's text, imported with ?raw - e.g. `import pencilSvg from '../icons/pencil.svg?raw'`.
  svg: string
  // In px. The files only carry a viewBox, so this is what sizes them.
  size: number
  // For the odd one that isn't square.
  height?: number
  className?: string
}

// An icon from this folder, drawn in the colour of the text around it - the
// files use currentColor, so CSS color and :hover reach them like text.
function Icon({ svg, size, height = size, className }: IconProps) {
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      style={{ width: size, height }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default Icon
