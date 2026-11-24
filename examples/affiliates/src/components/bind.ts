// A text input bound to one field of a Void form (useForm): its value and onChange, typed from the
// action's body. Empty text is `empty` (e.g. null for an optional field); `as` shapes what's typed.
type Text<D> = { [K in keyof D]: string extends D[K] ? K : never }[keyof D] & string;

export function bind<D, K extends Text<D>>(
  form: { data: D; setData: <F extends keyof D & string>(field: F, value: D[F]) => void },
  name: K,
  {
    empty = "",
    as = (text: string) => text,
  }: { empty?: D[K] | ""; as?: (text: string) => string } = {},
) {
  return {
    value: (form.data[name] ?? "") as string,
    onChange: (e: { target: { value: string } }) => {
      const text = as(e.target.value);
      form.setData(name, (text === "" ? empty : text) as D[K]);
    },
  };
}
