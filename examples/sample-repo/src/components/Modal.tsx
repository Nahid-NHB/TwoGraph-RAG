import { forwardRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

/** forwardRef component — exercises wrapper detection. */
export const Modal = forwardRef<HTMLDialogElement, ModalProps>(function Modal(
  { title, children, onClose },
  ref,
) {
  return (
    <dialog ref={ref}>
      <header>
        <h2>{title}</h2>
        <button onClick={onClose}>×</button>
      </header>
      {children}
    </dialog>
  );
});
