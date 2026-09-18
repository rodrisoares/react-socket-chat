import './styles.scss';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A linha de cima: o que o interruptor liga. */
  label: string;
  /**
   * A linha de baixo, menor: o que muda de fato ao ligar ou desligar.
   *
   * Vale a pena porque o rótulo sozinho descreve o botão, e não a
   * consequência — "Só administradores enviam" não diz que os demais continuam
   * lendo tudo.
   */
  hint?: string;
}

/**
 * Um checkbox de verdade por baixo, pintado como interruptor.
 *
 * Virou componente porque o desenho dele vivia no stylesheet da tela de
 * Configurações, e o painel de detalhes do grupo usava as mesmas classes sem
 * declará-las. Essa página é carregada sob demanda, então o CSS só existia
 * depois de alguém visitar Ajustes: quem abrisse os detalhes do grupo antes
 * disso via um checkbox nativo com o texto todo na mesma linha, e quem
 * abrisse depois via o interruptor certo. O mesmo componente, com duas
 * aparências, decididas pelo histórico de navegação.
 *
 * O `<input>` continua sendo um checkbox de verdade, fora da tela mas focável:
 * é ele que o teclado e o leitor de tela alcançam. O trilho é só pintura, e
 * por isso `aria-hidden`.
 */
export default function Switch({ checked, onChange, label, hint }: SwitchProps) {
  return (
    <label className='switch'>
      <input
        type='checkbox'
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className='switch-track' aria-hidden='true' />
      <span className='switch-text'>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
