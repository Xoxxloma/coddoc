package org.agro.ledger.directory;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Регионы, хозяйства и зоны ответственности сотрудников: читаются прямо из схемы земельного реестра. */
@Repository
@RequiredArgsConstructor
public class RegionDirectoryDao {

  private final JdbcTemplate jdbc;

  public record Unit(long id, String name, Long regionId) {}

  public List<Unit> regions() {
    return jdbc.query("select id, name from landreg.region where archived = false order by name",
        (rs, i) -> new Unit(rs.getLong("id"), rs.getString("name"), null));
  }

  public List<Unit> farms() {
    return jdbc.query("select id, name, region_id from landreg.farm where archived = false order by name",
        (rs, i) -> new Unit(rs.getLong("id"), rs.getString("name"), rs.getLong("region_id")));
  }

  public List<Unit> farmsOfRegion(long regionId) {
    return jdbc.query("select id, name, region_id from landreg.farm where archived = false and region_id = ? order by name",
        (rs, i) -> new Unit(rs.getLong("id"), rs.getString("name"), rs.getLong("region_id")), regionId);
  }

  /** Пустой список — у сотрудника нет закреплённых регионов, сводка ему видна по всем. */
  public List<Unit> scopeOf(String employeeNumber) {
    return jdbc.query("select r.id, r.name from landreg.employee_scope s join landreg.region r on r.id = s.region_id "
            + "where s.employee_number = ? order by r.name",
        (rs, i) -> new Unit(rs.getLong("id"), rs.getString("name"), null), employeeNumber);
  }
}
