import './styles.scss';
import { useEffect, useRef, useState } from 'react';

import Modal from 'components/Modal';

/** Lado da imagem gerada. Suficiente para o avatar em qualquer tamanho da tela. */
const OUTPUT_SIZE = 512;

/** Lado da janela de recorte, em pixels de tela. O mesmo valor mora no SCSS. */
const VIEWPORT = 260;

/** Até onde dá para aproximar. Além disto a foto vira borrão. */
const MAX_ZOOM = 4;

interface ImageCropperProps {
  /** O arquivo escolhido, ainda sem recorte. */
  file: File;
  onCancel: () => void;
  /** Recebe a imagem recortada, pronta para enviar. */
  onCropped: (blob: Blob) => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Recorte quadrado de uma foto, antes de ela virar avatar.
 *
 * Feito à mão com canvas, sem biblioteca: são duas contas e um arrasto, e uma
 * dependência para isso custaria mais no pacote do que o código custa aqui.
 *
 * A lógica inteira é uma transformação entre dois espaços — o da tela, onde a
 * pessoa arrasta, e o da imagem original, de onde os pixels saem. `scale` é o
 * quanto a imagem foi esticada para caber, e `offset` o quanto ela foi movida a
 * partir do centro.
 */
export default function ImageCropper({ file, onCancel, onCropped }: ImageCropperProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [url, setUrl] = useState('');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const dragFrom = useRef<Point | null>(null);

  /**
   * O endereço temporário do arquivo escolhido.
   *
   * Revogado ao sair: cada `createObjectURL` sem revogação segura o arquivo
   * inteiro na memória da aba até a página recarregar — e aqui se fala de fotos
   * de vários megabytes.
   */
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);

    return () => URL.revokeObjectURL(next);
  }, [file]);

  /**
   * A escala mínima: a que faz o menor lado cobrir a janela inteira.
   *
   * É o piso do zoom, e não um valor inicial. Sem ele dá para afastar até
   * sobrar canto vazio, e o avatar sairia com borda de nada.
   */
  const baseScale = size
    ? Math.max(VIEWPORT / size.width, VIEWPORT / size.height)
    : 1;
  const scale = baseScale * zoom;

  /** Quanto a imagem pode andar de cada lado sem descobrir a janela. */
  function limitsOf(current: number): Point {
    if (!size) return { x: 0, y: 0 };

    return {
      x: Math.max(0, (size.width * current - VIEWPORT) / 2),
      y: Math.max(0, (size.height * current - VIEWPORT) / 2),
    };
  }

  function clamp(next: Point, current: number): Point {
    const limit = limitsOf(current);

    return {
      x: Math.min(limit.x, Math.max(-limit.x, next.x)),
      y: Math.min(limit.y, Math.max(-limit.y, next.y)),
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const from = dragFrom.current;
    if (!from) return;

    setOffset(clamp({ x: event.clientX - from.x, y: event.clientY - from.y }, scale));
  }

  function onPointerUp() {
    dragFrom.current = null;
  }

  /** Aproximar reposiciona: o que era borda pode deixar de ser. */
  function changeZoom(next: number) {
    setZoom(next);
    setOffset((current) => clamp(current, baseScale * next));
  }

  /**
   * Passa o que está dentro da janela para um quadrado de 512px.
   *
   * A conta é a inversa do que a tela mostra: onde fica, na imagem original, o
   * canto superior esquerdo da janela. O centro da imagem está no centro da
   * janela mais o deslocamento, então basta voltar meia janela e dividir pela
   * escala para sair do espaço da tela e chegar ao da imagem.
   */
  function confirm() {
    const image = imageRef.current;
    if (!image || !size) return;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;

    const context = canvas.getContext('2d');
    if (!context) {
      setError('Este navegador não conseguiu recortar a imagem.');
      return;
    }

    // Fundo branco antes de desenhar: a saída é JPEG, que não tem
    // transparência — sem isto, um PNG vazado sairia com o fundo preto.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const visible = VIEWPORT / scale;
    const sourceX = (size.width * scale - VIEWPORT) / 2 / scale - offset.x / scale;
    const sourceY = (size.height * scale - VIEWPORT) / 2 / scale - offset.y / scale;

    context.drawImage(
      image,
      sourceX,
      sourceY,
      visible,
      visible,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );

    canvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
        else setError('Não foi possível gerar a imagem recortada.');
      },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <Modal title='Recortar foto' onClose={onCancel}>
      <p className='cropper-hint'>
        Arraste para escolher o enquadramento e use o controle para aproximar.
      </p>

      {error && <p className='cropper-error'>{error}</p>}

      <div
        className='cropper-viewport'
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {url && (
          <img
            ref={imageRef}
            src={url}
            alt=''
            draggable={false}
            style={
              size
                ? {
                    width: size.width * scale,
                    height: size.height * scale,
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  }
                : undefined
            }
            onLoad={(event) => {
              const node = event.currentTarget;
              setSize({ width: node.naturalWidth, height: node.naturalHeight });
            }}
            onError={() => setError('Não foi possível abrir esta imagem.')}
          />
        )}
      </div>

      <label className='cropper-zoom'>
        <span>Aproximar</span>
        <input
          type='range'
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => changeZoom(Number(event.target.value))}
          aria-label='Aproximar a foto'
        />
      </label>

      <div className='cropper-actions'>
        <button type='button' className='cropper-cancel' onClick={onCancel}>
          Cancelar
        </button>
        <button
          type='button'
          className='cropper-confirm'
          disabled={!size}
          onClick={confirm}
        >
          Usar esta foto
        </button>
      </div>
    </Modal>
  );
}
