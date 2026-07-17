import { FileText } from 'lucide-react'
import mdIcon from '../static/icons/icons8-markdown-48.png'
import htmlIcon from '../static/icons/icons8-html-48.png'
import docxIcon from '../static/icons/icons8-word-file-48.png'
import pdfIcon from '../static/icons/icons8-pdf-48.png'
import xlsxIcon from '../static/icons/icons8-xls-48.png'
import pptIcon from '../static/icons/icons8-ppt-48.png'
import csvIcon from '../static/icons/icons8-csv-48.png'
import tsIcon from '../static/icons/icons8-typescript-48.png'
import jsIcon from '../static/icons/icons8-javascript-48.png'
import jsonIcon from '../static/icons/icons8-json-48.png'
import cssIcon from '../static/icons/icons8-css-48.png'
import pythonIcon from '../static/icons/icons8-python-48.png'
import javaIcon from '../static/icons/icons8-java-48.png'
import cIcon from '../static/icons/icons8-c-48.png'
import cppIcon from '../static/icons/icons8-cpp-48.png'
import phpIcon from '../static/icons/icons8-php-48.png'
import goIcon from '../static/icons/icons8-golang-48.png'
import swiftIcon from '../static/icons/icons8-swift-48.png'
import rubyIcon from '../static/icons/icons8-ruby-48.png'
import cSharpIcon from '../static/icons/icons8-c-sharp-48.png'
import rustIcon from '../static/icons/icons8-rust-48.png'
import shellIcon from '../static/icons/icons8-shell-48.png'
import xmlIcon from '../static/icons/icons8-xml-48.png'

export default function FileIcon(props: { filename: string; className?: string }) {
  const { filename, className } = props
  const ext = filename.split('.').pop() || ''
  // txt, md, html, doc, docx, pdf, excel, pptx, csv, and all text-based files, including code files.
  const extIconHash: { [ext: string]: string } = {
    md: mdIcon,
    htm: htmlIcon,
    htmx: htmlIcon,
    html: htmlIcon,
    doc: docxIcon,
    docx: docxIcon,
    pdf: pdfIcon,
    xls: xlsxIcon,
    xlsx: xlsxIcon,
    pptx: pptIcon,
    csv: csvIcon,

    ts: tsIcon,
    tsx: tsIcon,
    js: jsIcon,
    jsx: jsIcon,
    json: jsonIcon,
    css: cssIcon,
    sass: cssIcon,
    less: cssIcon,
    scss: cssIcon,
    styl: cssIcon,
    stylus: cssIcon,
    py: pythonIcon,
    java: javaIcon,
    c: cIcon,
    h: cIcon,
    cpp: cppIcon,
    cxx: cppIcon,
    cc: cppIcon,
    hh: cppIcon,
    hpp: cppIcon,
    hxx: cppIcon,
    php: phpIcon,
    go: goIcon,
    swift: swiftIcon,
    rb: rubyIcon,
    cs: cSharpIcon,
    rs: rustIcon,
    sh: shellIcon,
    cmd: shellIcon,
    bat: shellIcon,
    ps1: shellIcon,
    bash: shellIcon,
    xml: xmlIcon,
  }
  const src = extIconHash[ext]
  if (src) {
    return <img src={src} className={className} />
  } else {
    return <FileText className={className} strokeWidth={1} />
  }
}
