interface ScrollToTopButtonProps {
  onClick: () => void;
}

function ScrollToTopButton({ onClick }: ScrollToTopButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-16 right-6 flex cursor-pointer items-center gap-1.5 rounded-full bg-zinc-200/90 px-3.5 py-2 text-xs font-medium text-zinc-900 shadow-lg backdrop-blur-sm transition-all hover:bg-zinc-100"
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
