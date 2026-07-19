import {Icons} from '@pkmn/img';
import {gen9} from '../../data/gen';
import {typeGradient} from '../sixoh/typeColors';

/** Six icons + type badges: the "it registered correctly" glance (§4a). */
export function TeamPreviewRow({species}: {species: string[]}) {
  const gen = gen9();
  return (
    <div className="team-preview-row">
      {species.map((name, i) => {
        const icon = Icons.getPokemon(name);
        const types = gen.species.get(name)?.types ?? [];
        return (
          <div key={`${name}-${i}`} className="preview-mon">
            <span className="mon-tile" style={{backgroundImage: typeGradient(types)}}>
              <span style={icon.css} title={name} />
            </span>
            <span className="preview-name">{name}</span>
            <span className="type-badges">
              {types.map(type => (
                <span key={type} className={`type-badge type-${type.toLowerCase()}`}>
                  {type}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
