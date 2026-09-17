import './styles.scss';
import { useRef, useState } from 'react';
import { FiCheck, FiUpload } from 'react-icons/fi';
import { FaUser, FaUsers } from 'react-icons/fa';

import ImageCropper from 'components/ImageCropper';
import Modal from 'components/Modal';
import fetch from 'config/fetchInstance';
import { avatarOptions, type AvatarKind } from 'utils/avatar';
import { UPLOAD_MAX_MB } from '@react-chat/shared';

interface AvatarPickerProps {
  /** Avatar em uso, já marcado ao abrir. String vazia = sem foto. */
  current: string;
  /** Recebe '' quando o usuário escolhe remover a foto. */
  onSelect: (url: string) => void;
  onClose: () => void;
  /** Rosto para pessoa, pictograma para grupo. */
  kind?: AvatarKind;
}

/** Textos e ícone-padrão de cada uso do diálogo. */
const COPY = {
  user: {
    title: 'Escolher avatar',
    hint: 'Escolha uma das opções abaixo e confirme para trocar sua foto. A primeira remove a foto e volta para o ícone padrão.',
    noneLabel: 'Sem foto',
    optionLabel: 'Avatar',
  },
  group: {
    title: 'Escolher ícone do grupo',
    hint: 'Escolha um ícone e confirme para trocar a imagem do grupo. O primeiro remove a imagem e volta para o ícone padrão.',
    noneLabel: 'Sem imagem',
    optionLabel: 'Ícone',
  },
} as const;

/** Diálogo com avatares pré-definidos — substitui o sorteio às cegas. */
export default function AvatarPicker({
  current,
  onSelect,
  onClose,
  kind = 'user',
}: AvatarPickerProps) {
  const [chosen, setChosen] = useState(current);
  /** Arquivo escolhido esperando recorte; null = nenhum. */
  const [toCrop, setToCrop] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const options = avatarOptions(kind);
  const copy = COPY[kind];

  function confirm() {
    onSelect(chosen);
    onClose();
  }

  /**
   * Confere antes de abrir o recorte.
   *
   * O `accept` do seletor é só uma sugestão — o sistema deixa escolher "todos
   * os arquivos" —, e o teto vale porque o recorte carrega a foto inteira na
   * memória da aba antes de reduzi-la.
   */
  function chooseFile(file: File | null) {
    setError('');
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Escolha um arquivo de imagem.');
      return;
    }
    if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
      setError(`A imagem passa do limite de ${UPLOAD_MAX_MB} MB.`);
      return;
    }

    setToCrop(file);
  }

  /**
   * Sobe a foto recortada e a deixa escolhida — mas não a salva.
   *
   * Quem grava é o Salvar da tela que abriu este diálogo, como acontece com os
   * 16 avatares: é o que permite subir uma foto, olhar, e desistir.
   */
  async function upload(blob: Blob) {
    setToCrop(null);
    setIsUploading(true);
    setError('');

    try {
      const form = new FormData();
      form.append('image', blob, 'avatar.jpg');

      const response = await fetch.post<{ url: string }>('/api/me/avatar', form);
      setChosen(response.data.url);
    } catch {
      setError('Não foi possível enviar a foto.');
    } finally {
      setIsUploading(false);
      // Zera o campo: o mesmo arquivo precisa poder ser escolhido de novo.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <Modal title={copy.title} onClose={onClose}>
      <p className='avatar-picker-hint'>{copy.hint}</p>

      <ul className='avatar-picker-grid'>
        <li>
          <button
            type='button'
            className={`avatar-picker-option avatar-picker-option--none${
              chosen === '' ? ' avatar-picker-option--chosen' : ''
            }`}
            aria-pressed={chosen === ''}
            aria-label={copy.noneLabel}
            title={copy.noneLabel}
            onClick={() => setChosen('')}
            onDoubleClick={confirm}
          >
            {kind === 'group' ? <FaUsers size={22} /> : <FaUser size={22} />}
            {chosen === '' && (
              <span className='avatar-picker-check' aria-hidden='true'>
                <FiCheck size={14} />
              </span>
            )}
          </button>
        </li>

        {options.map((option) => {
          const isChosen = option.url === chosen;
          return (
            <li key={option.seed}>
              <button
                type='button'
                className={`avatar-picker-option${isChosen ? ' avatar-picker-option--chosen' : ''}`}
                aria-pressed={isChosen}
                aria-label={`${copy.optionLabel} ${option.seed}`}
                onClick={() => setChosen(option.url)}
                onDoubleClick={confirm}
              >
                <img src={option.url} alt='' loading='lazy' />
                {isChosen && (
                  <span className='avatar-picker-check' aria-hidden='true'>
                    <FiCheck size={14} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        Foto própria, ao lado dos 16 prontos. Fica depois da grade de propósito:
        escolher um avatar pronto é o caminho de um clique, e enviar arquivo é o
        que a pessoa procura quando nenhum deles serve.
      */}
      <button
        type='button'
        className='avatar-picker-upload'
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
      >
        <FiUpload size={16} />
        {isUploading ? 'Enviando…' : 'Enviar uma foto'}
      </button>

      <input
        ref={fileInputRef}
        type='file'
        hidden
        accept='image/png,image/jpeg,image/gif,image/webp'
        onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
      />

      {error && <p className='avatar-picker-error'>{error}</p>}

      {toCrop && (
        <ImageCropper
          file={toCrop}
          onCancel={() => setToCrop(null)}
          onCropped={(blob) => void upload(blob)}
        />
      )}

      <div className='avatar-picker-actions'>
        <button type='button' className='avatar-picker-cancel' onClick={onClose}>
          Cancelar
        </button>
        <button
          type='button'
          className='avatar-picker-confirm'
          disabled={!chosen || chosen === current}
          onClick={confirm}
        >
          Usar este avatar
        </button>
      </div>
    </Modal>
  );
}
