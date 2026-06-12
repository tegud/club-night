import dynalite from 'dynalite';

export default async function setup(): Promise<() => Promise<void>> {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(8000, () => resolve()));

  return async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };
}
