import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="text-lg font-semibold">Page not found</p>
        <Link to="/projects" className="mt-2 inline-block text-sm text-primary hover:underline">
          Back to your projects
        </Link>
      </div>
    </div>
  );
}
