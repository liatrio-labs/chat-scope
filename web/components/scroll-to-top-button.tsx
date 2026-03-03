interface ScrollToTopButtonProps {
  onClick: () => void;
}

function ScrollToTopButton({ onClick }: ScrollToTopButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-16 right-6 flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--brand-primary)] px-3.5 py-2 text-xs font-semibold text-[#0b2210] shadow-[var(--brand-shadow)] backdrop-blur-sm transition-all hover:bg-[var(--brand-primary-hover)]"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 10l7-7m0 0l7 7m-7-7v18"
        />
      </svg>
      <span>Top</span>
    </button>
  );
}

export default ScrollToTopButton;
