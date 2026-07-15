import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const PlusIcon = (props: IconProps) => <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
export const CloseIcon = (props: IconProps) => <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const UploadIcon = (props: IconProps) => <Icon {...props}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" /></Icon>;
export const FolderIcon = (props: IconProps) => <Icon {...props}><path d="M3 7.5h7l2-2h9v13H3z" /></Icon>;
export const SparkleIcon = (props: IconProps) => <Icon {...props}><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></Icon>;
export const ArrowIcon = (props: IconProps) => <Icon {...props}><path d="M5 12h14m-5-5 5 5-5 5" /></Icon>;
export const CheckIcon = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>;
export const ImageIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 3.5 3.5 2-2L20 19" /></Icon>;
export const MoreIcon = (props: IconProps) => <Icon {...props}><circle cx="5" cy="12" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="19" cy="12" r=".8" fill="currentColor" /></Icon>;
